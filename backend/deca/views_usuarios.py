"""CRUD mínimo de usuarios (`django.contrib.auth.User` estándar) para que el
admin de esta instalación pueda dar de alta operadores -- decisión de
arquitectura: solo dos roles, `is_staff=True` (admin, ve Configuración) /
`is_staff=False` (operador, solo gestiona expediciones). Sin tercer rol."""
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import generics, serializers
from rest_framework.permissions import IsAdminUser

User = get_user_model()


class UsuarioSerializer(serializers.ModelSerializer):
    """Usuario de la instalación. La contraseña es de solo escritura y pasa por
    los validadores de Django; obligatoria al crear, opcional al editar."""
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'is_staff', 'is_active', 'password']
        read_only_fields = ['id']

    def validate_password(self, valor):
        if valor:
            validate_password(valor)
        return valor

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        if not password:
            raise serializers.ValidationError({'password': 'La contraseña es obligatoria al crear un usuario.'})
        usuario = User(**validated_data)
        usuario.set_password(password)
        usuario.save()
        return usuario

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        for campo, valor in validated_data.items():
            setattr(instance, campo, valor)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class UsuarioListCreateView(generics.ListCreateAPIView):
    """Lista y alta de usuarios (solo administradores)."""
    permission_classes = [IsAdminUser]
    serializer_class = UsuarioSerializer
    queryset = User.objects.all().order_by('username')


class UsuarioDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Detalle, edición y baja de un usuario (solo administradores)."""
    permission_classes = [IsAdminUser]
    serializer_class = UsuarioSerializer
    queryset = User.objects.all()
